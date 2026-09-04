import { useEffect, useState } from "react";
import { getClasses } from "../api";
import type { PkClass } from "../types";
import { Layout, styles } from "./Layout";

export function ClassPicker({
  onBack,
  onClassSelected,
}: {
  onBack: () => void;
  onClassSelected: (pkClass: PkClass) => void;
}) {
  const [classes, setClasses] = useState<PkClass[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getClasses()
      .then(setClasses)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load classes"));
  }, []);

  return (
    <Layout title="Who's taking the quiz?" onBack={onBack}>
      {classes === null && !error && <p style={styles.muted}>Loading...</p>}
      {classes && classes.length === 0 && <p style={styles.muted}>No classes yet - add some content first.</p>}

      {classes && classes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 320 }}>
          {classes.map((c) => (
            <button key={c.id} style={styles.secondaryButton} onClick={() => onClassSelected(c)}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      {error && <p style={styles.error}>{error}</p>}
    </Layout>
  );
}
