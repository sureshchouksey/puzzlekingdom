// Privacy Policy + Terms of Service copy, shared between the pre-passcode
// Gate screen and the in-app Legal screen (Legal.tsx) so there's exactly
// one place this text lives. Added 19 September 2026 as part of the
// pre-production legal audit - see
// plan/Legal-and-Copyright-Production-Audit.md in the PuzzleKingdom
// project docs. This is a good-faith baseline, not a substitute for a
// lawyer's review before a real public launch.

const LAST_UPDATED = "19 September 2026";
const CONTACT_EMAIL = "sureshchouksey@gmail.com";

export function PrivacyPolicyContent() {
  return (
    <div className="prose prose-sm mx-auto max-w-2xl text-left text-sm leading-relaxed text-muted-foreground">
      <p className="text-xs text-muted-foreground/70">Last updated: {LAST_UPDATED}</p>

      <h2 className="mt-6 text-base font-semibold text-foreground">What Puzzle Kingdom is</h2>
      <p>
        Puzzle Kingdom is a family learning app: a parent or guardian creates one family account, then sets up a
        profile for each child to take quizzes, play learning games, and track progress. This policy explains what
        information we collect, why, and how it's kept.
      </p>

      <h2 className="mt-6 text-base font-semibold text-foreground">Information we collect</h2>
      <p>From the parent/guardian who creates the family account:</p>
      <ul className="list-disc pl-5">
        <li>An email address and a PIN (stored only as a one-way hash, never as plain text), used to sign in.</li>
      </ul>
      <p>For each child profile the parent creates:</p>
      <ul className="list-disc pl-5">
        <li>A display name and a chosen illustrated avatar (no photo upload).</li>
        <li>A 4-digit PIN, stored only as a one-way hash, used for that child to open their own profile.</li>
        <li>
          Quiz and activity history - scores, topics practiced, time spent, and similar progress data - so parents
          and the child can see progress over time.
        </li>
      </ul>
      <p>
        We do not knowingly collect a child's email address, physical address, phone number, or photo. We do not run
        third-party advertising or analytics trackers in the app.
      </p>

      <h2 className="mt-6 text-base font-semibold text-foreground">How this information is used</h2>
      <ul className="list-disc pl-5">
        <li>To run the core features: quizzes, games, progress reports, and the leaderboard within your own family.</li>
        <li>
          To power the AI Study Buddy tutor and AI-generated quiz content: the relevant question text or chat
          message is sent to Anthropic's Claude API to generate a response. Anthropic processes that data under its
          own API terms and does not use it to advertise to your family.
        </li>
        <li>To let a parent/guardian review and manage their children's profiles and progress.</li>
      </ul>
      <p>We do not sell personal information, and we do not share it with advertisers.</p>

      <h2 className="mt-6 text-base font-semibold text-foreground">Where information is stored</h2>
      <p>
        Account and progress data is stored in a managed PostgreSQL database (Supabase). Reasonable technical
        safeguards are used (PIN hashing, access controls), but no online service can guarantee absolute security.
      </p>

      <h2 className="mt-6 text-base font-semibold text-foreground">Children's privacy</h2>
      <p>
        Puzzle Kingdom is designed to be used by children only through a family account that a parent or guardian
        creates and controls. The parent/guardian sets up each child profile, can view that child's activity, and
        can request deletion of a child's profile and its data at any time by contacting us below.
      </p>

      <h2 className="mt-6 text-base font-semibold text-foreground">Your choices</h2>
      <ul className="list-disc pl-5">
        <li>You can review or update a child's profile from the family dashboard at any time.</li>
        <li>You can request deletion of your family account, or any single child's profile, by contacting us.</li>
      </ul>

      <h2 className="mt-6 text-base font-semibold text-foreground">Changes to this policy</h2>
      <p>
        If this policy changes, we'll update the "Last updated" date above. Continued use of the app after a change
        means you accept the updated policy.
      </p>

      <h2 className="mt-6 text-base font-semibold text-foreground">Contact</h2>
      <p>Questions or deletion requests: {CONTACT_EMAIL}</p>
    </div>
  );
}

export function TermsOfServiceContent() {
  return (
    <div className="prose prose-sm mx-auto max-w-2xl text-left text-sm leading-relaxed text-muted-foreground">
      <p className="text-xs text-muted-foreground/70">Last updated: {LAST_UPDATED}</p>

      <h2 className="mt-6 text-base font-semibold text-foreground">Who can use Puzzle Kingdom</h2>
      <p>
        A family account must be created by a parent or legal guardian who is at least 18 years old. That adult is
        responsible for the child profiles they create and for supervising their children's use of the app.
      </p>

      <h2 className="mt-6 text-base font-semibold text-foreground">The service</h2>
      <p>
        Puzzle Kingdom provides quizzes, learning games, an AI study tutor, and progress reports for educational
        practice. It is provided "as is," without warranty of any kind, and content (including AI-generated
        explanations) may occasionally be incomplete or contain errors - it's a study aid, not a substitute for
        instruction from a qualified teacher.
      </p>

      <h2 className="mt-6 text-base font-semibold text-foreground">Acceptable use</h2>
      <ul className="list-disc pl-5">
        <li>Don't attempt to bypass the app passcode or access another family's data.</li>
        <li>Don't upload content you don't have the right to use.</li>
        <li>Use the AI Study Buddy for its intended study purpose, not to generate unrelated or harmful content.</li>
      </ul>

      <h2 className="mt-6 text-base font-semibold text-foreground">Third-party names and trademarks</h2>
      <p>
        "Claude" and the Claude name are trademarks of Anthropic, PBC. Puzzle Kingdom's Certification Prep content is
        independently authored study material referencing publicly available information about Anthropic's Claude
        certification programs; it is <strong>not affiliated with, endorsed by, or sponsored by Anthropic</strong>,
        and exam details shown in the app are indicative estimates from a third-party study guide, not official
        figures published by Anthropic. All other course/exam content is used to describe what it helps you study
        for, and remains the property of its respective owner.
      </p>

      <h2 className="mt-6 text-base font-semibold text-foreground">Account and data</h2>
      <p>
        You're responsible for keeping your family passcode and PINs reasonably private. You can request deletion of
        your account and data at any time - see the Privacy Policy for how.
      </p>

      <h2 className="mt-6 text-base font-semibold text-foreground">Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, Puzzle Kingdom and its operator aren't liable for indirect,
        incidental, or consequential damages arising from use of the app. Nothing here limits liability that can't
        legally be limited.
      </p>

      <h2 className="mt-6 text-base font-semibold text-foreground">Changes to these terms</h2>
      <p>
        If these terms change, we'll update the "Last updated" date above. Continued use of the app after a change
        means you accept the updated terms.
      </p>

      <h2 className="mt-6 text-base font-semibold text-foreground">Contact</h2>
      <p>Questions: {CONTACT_EMAIL}</p>
    </div>
  );
}
