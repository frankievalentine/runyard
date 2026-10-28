import { use } from "react";
import { api } from "./api.ts";

const health = api.health.$get().then((res) => res.json());

export default function App() {
  const { version } = use(health);
  return (
    <main>
      <h1>Runyard</h1>
      <p>Server {version}</p>
    </main>
  );
}
