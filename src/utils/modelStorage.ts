/**
 * Utilities for reading and deleting TF.js models stored in IndexedDB,
 * and for triggering browser JSON downloads.
 *
 * TF.js stores models in a database called "tensorflowjs" with two object
 * stores:
 *   - models_store     (keyPath: "modelPath") – topology + binary weights
 *   - model_info_store (keyPath: "modelPath") – metadata / size info
 */

const DB_NAME = "tensorflowjs";
const MODEL_STORE = "models_store";
const INFO_STORE = "model_info_store";

function openTfDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Read raw model artifacts from TF.js IndexedDB.
 * Returns `null` if the database or key does not exist.
 */
export async function readModelArtifact(key: string): Promise<unknown | null> {
  let db: IDBDatabase;
  try {
    db = await openTfDb();
  } catch {
    return null;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MODEL_STORE, "readonly");
    const store = tx.objectStore(MODEL_STORE);
    const req = store.get(key);
    req.onsuccess = () => {
      db.close();
      // TF.js wraps the artifact under the `modelArtifacts` property.
      resolve((req.result as { modelArtifacts?: unknown } | undefined)?.modelArtifacts ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/**
 * Delete a model entry (both stores) from TF.js IndexedDB.
 * Silently succeeds if the key does not exist.
 */
export async function deleteModelArtifact(key: string): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openTfDb();
  } catch {
    return; // nothing to delete if the DB doesn't exist yet
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction([MODEL_STORE, INFO_STORE], "readwrite");
    tx.objectStore(MODEL_STORE).delete(key);
    tx.objectStore(INFO_STORE).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  // Process in chunks to avoid maximum call-stack errors on large buffers
  // (e.g. neural-network weights which can be several MB).
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32 768 bytes
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(parts.join(""));
}

/** Trigger a browser download of `data` serialised as a JSON file. */
export function downloadJson(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Load the model stored under `key` from TF.js IndexedDB and trigger a
 * browser download of a self-contained JSON file.
 *
 * Binary weight data is serialised as a base-64 string so the file can be
 * stored / shared without losing information.  Pass `extraData` to merge
 * additional fields (e.g. reward weights) into the top-level JSON object.
 *
 * @returns `true` when the model was found and downloaded, `false` otherwise.
 */
export async function downloadModelJson(
  key: string,
  extraData: Record<string, unknown> = {},
  filename = `${key}.json`,
): Promise<boolean> {
  const artifact = await readModelArtifact(key);
  if (artifact == null) return false;

  const { weightData, ...rest } = artifact as {
    weightData?: ArrayBuffer;
    [k: string]: unknown;
  };

  const exportable: Record<string, unknown> = { ...rest, ...extraData };
  if (weightData instanceof ArrayBuffer) {
    exportable.weightDataBase64 = arrayBufferToBase64(weightData);
  }

  downloadJson(exportable, filename);
  return true;
}
