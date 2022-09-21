import { DependencyList, useEffect } from "react";

export default function useDocumentEventListener<
  K extends keyof DocumentEventMap
>(
  arg: {
    type: K;
    listener: (this: Document, ev: DocumentEventMap[K]) => any;
    options?: boolean | AddEventListenerOptions;
  },
  deps: DependencyList
) {
  const { type, listener, options } = arg;
  useEffect(() => {
    document.addEventListener(type, listener, options);
    return () => {
      document.removeEventListener(type, listener);
    };
  }, deps);
}
