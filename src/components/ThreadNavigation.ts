import { createContext } from "react";

export const ThreadNavigation = createContext<((url: string) => Promise<void>) | null>(null);
