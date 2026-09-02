import { Layout, styles } from "./Layout";

export function Home({
  name,
  onPlay,
  onAddContent,
}: {
  name: string | null;
  onPlay: () => void;
  onAddContent: () => void;
}) {
  return (
    <Layout title={name ? `Welcome back, ${name}!` : "Puzzle Kingdom"}>
      <p style={{ color: "#5a5148", marginBottom: 32 }}>What would you like to do?</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 320 }}>
        <button style={styles.primaryButton} onClick={onPlay}>
          Take a quiz
        </button>
        <button style={styles.secondaryButton} onClick={onAddContent}>
          Add new content (parent)
        </button>
      </div>
    </Layout>
  );
}
