import { useEffect, useState } from "react";
import { getAllTypes } from "@/lib/objectTypes";

// Returns the merged list of built-in + custom types, re-rendering when the
// custom-type registry changes.
export function useTypes() {
  const [types, setTypes] = useState(getAllTypes);
  useEffect(() => {
    const on = () => setTypes(getAllTypes());
    window.addEventListener("chronicle-types-changed", on);
    return () => window.removeEventListener("chronicle-types-changed", on);
  }, []);
  return types;
}
