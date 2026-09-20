// Reference course structure for each Claude certification, shown in
// CertPrepHub.tsx's "Content" section (19 September 2026, direct user
// request - "course content should be like this [URL] add this URL as
// ref also").
//
// Unlike certExamInfo.ts (an independent third-party study guide), this
// points at the official source: Anthropic's own Skilljar learning path
// for the certification, linked directly from the hub as "View the
// official course". Module names and durations are short, factual
// details read off that public page (titles/numbers aren't the kind of
// thing copyright protects). The one-line "focus" text per module WAS
// copied verbatim from that page originally - rewritten 19 September
// 2026 (pre-production legal audit, see
// plan/Legal-and-Copyright-Production-Audit.md) into this app's own
// words, same meaning, so nothing here is a direct copy of Anthropic's
// own descriptive text. Keyed by this app's own seeded subject name,
// same convention as CERT_EXAM_INFO, so a certification with no entry
// here just doesn't show a module breakdown - the dynamic topic list
// below it still works either way.
export type CourseModule = {
  name: string;
  durationMinutes: number;
  focus: string;
  // Every real DB topic tag (schema.ts's topics table) that belongs
  // under this module, always starting with the module's own name -
  // used by SubjectPicker.tsx to group the Quest map into one node per
  // module instead of one per raw topic (20 September 2026, direct user
  // request - the map was showing granular sub-sections like "Pattern
  // Selection" as if they were top-level topics, when this app only
  // really has 5). For "Claude Platform & Solution Design" that's the 8
  // sections confirmed by
  // docs/Professional Certifications/generated/claude-certified-architect-professional-sections-source-note.txt,
  // plus "Task Decomposition" and "Evaluation, Testing & Optimisation
  // for Architects" - two topics that don't appear in that note (the
  // second is actually one of the real exam's domain names, not a
  // course-module section) but were folded in here rather than left out
  // of the Quest map entirely, per the user's explicit choice. Every
  // other module is just itself - a single, unsplit topic.
  topics: string[];
};

export type CourseInfo = {
  // The official Anthropic Partners Skilljar learning path for this
  // certification - linked from the hub as "View the official course".
  url: string;
  totalDurationMinutes: number;
  modules: CourseModule[];
};

export const CERT_COURSE_INFO: Record<string, CourseInfo> = {
  "Claude Certified Architect - Professional": {
    url: "https://anthropic-partners.skilljar.com/path/claude-certified-architect-professional",
    totalDurationMinutes: 733,
    modules: [
      {
        name: "Claude Platform & Solution Design",
        durationMinutes: 238,
        focus:
          "Covers turning a vague, ambiguous business problem into a solution architecture you can explain and defend.",
        topics: [
          "Claude Platform & Solution Design",
          "Platform Map & Primitives",
          "Pattern Selection",
          "Reference Architectures",
          "RAG Pipeline Design",
          "Model & Context Strategy",
          "Prompting as Architecture",
          "Entry Points & Governance",
          "Assembly & Recap",
          "Task Decomposition",
          "Evaluation, Testing & Optimisation for Architects",
        ],
      },
      {
        name: "Enterprise Integration & Production",
        durationMinutes: 158,
        focus: "Covers what it takes to carry a proven design from proof of concept through to enterprise-ready production.",
        topics: ["Enterprise Integration & Production"],
      },
      {
        name: "Responsible AI, Safety & Risk for Architects",
        durationMinutes: 114,
        focus:
          "Covers building out a complete safety stack for a Claude system - where each control sits, and what the fallback is if one fails.",
        topics: ["Responsible AI, Safety & Risk for Architects"],
      },
      {
        name: "Stakeholder Engagement, Lifecycle & GTM",
        durationMinutes: 178,
        focus:
          "Covers the stakeholder conversations that decide whether a working system actually launches, gets adopted, and keeps going after you step back.",
        topics: ["Stakeholder Engagement, Lifecycle & GTM"],
      },
      {
        name: "Team Enablement & Operational Productivity",
        durationMinutes: 45,
        focus: "Covers getting a team ready to run a live Claude system on their own, without you in the loop.",
        topics: ["Team Enablement & Operational Productivity"],
      },
    ],
  },
};
