import { useEffect, useRef } from "react";

export default function useDocumentEventListener<
  K extends keyof DocumentEventMap,
>(arg: { type: K; listener: (ev: DocumentEventMap[K]) => unknown }) {
  const ref = useRef<(ev: DocumentEventMap[K]) => unknown>(arg.listener);
  useEffect(() => {
    ref.current = arg.listener;
  }, [arg.listener]);
  const { type } = arg;
  useEffect(() => {
    const controller = new AbortController();
    document.addEventListener(type, (e) => ref.current(e), {
      signal: controller.signal,
    });
    return () => {
      controller.abort();
    };
  }, [type]);
}
