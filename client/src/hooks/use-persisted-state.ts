import { useEffect, useRef, useState } from "react";

type Serializer<T> = {
  serialize: (value: T) => string;
  deserialize: (raw: string) => T;
};

const defaultSerializer: Serializer<unknown> = {
  serialize: (value) => JSON.stringify(value),
  deserialize: (raw) => JSON.parse(raw),
};

export function usePersistedState<T>(
  key: string,
  initial: T | (() => T),
  serializer: Serializer<T> = defaultSerializer as Serializer<T>,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") {
      return typeof initial === "function" ? (initial as () => T)() : initial;
    }
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) return serializer.deserialize(raw);
    } catch {
      // fall through to initial
    }
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });

  const serializerRef = useRef(serializer);
  serializerRef.current = serializer;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, serializerRef.current.serialize(value));
    } catch {
      // ignore quota / private mode failures
    }
  }, [key, value]);

  return [value, setValue];
}

export const dateSerializer: Serializer<Date> = {
  serialize: (value) => value.toISOString(),
  deserialize: (raw) => {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  },
};
