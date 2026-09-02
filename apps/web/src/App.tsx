export default function App() {
  return (
    <main style={{ maxWidth: 640, margin: "80px auto", padding: "0 24px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Puzzle Kingdom</h1>
      <p style={{ color: "#5a5148" }}>
        Upload course content, get an AI-generated quiz, see how you did.
      </p>
      <p style={{ color: "#8a8177", fontSize: 14 }}>
        Screens land here one at a time, following the build order in{" "}
        <code>docs/PLAN.md</code>: Upload &rarr; Subject picker &rarr; Quiz &rarr; Results.
      </p>
    </main>
  );
}
