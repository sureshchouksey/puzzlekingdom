// Reference exam logistics for each Claude certification, shown in
// CertPrepHub.tsx's "Exam details" section (18 September 2026).
//
// Source: claudecertificationguide.com, an independent third-party study
// guide - NOT Anthropic's own published exam spec. Anthropic Academy's own
// course pages (used to build this app's actual quiz/flashcard content)
// don't publish question counts, timing, passing scores, or domain
// weightings anywhere this session could find. Treat every number below
// as indicative, not authoritative - and note that the source itself says
// several of these exams haven't launched yet (CCAR-P: "prep track not
// yet available"; CCAO-F: "launching soon, effective July 2026"; CCDV-F:
// "currently under development"), so these specifics may well change
// before a real exam ships. Keyed by this app's own seeded subject name so
// CertPrepHub can look this up per certification it finds in the database.
export type ExamDomain = { name: string; weight: number };

export type ExamInfo = {
  abbreviation: string;
  questions: number;
  durationMinutes: number;
  passingScore: string;
  cost: string;
  domains: ExamDomain[];
};

// Scales the real exam's own pace (minutes per question) down to however
// many questions this certification actually has seeded, rather than
// handing over the full real duration for a much smaller question bank -
// a shorter mock should still feel like a clock is genuinely running, not
// a nearly-untimed practice session. Shared by MockTest.tsx (starting a
// fresh mock) and App.tsx (retaking one from MockExamResults), so the two
// can never compute a different number for the same subject/count.
// Falls back to a flat 2 minutes/question when a subject has no entry
// here (a certification added without exam reference info yet).
export function mockExamTimeLimitMinutes(subjectName: string, questionCount: number): number {
  const info = CERT_EXAM_INFO[subjectName];
  if (!info) return Math.max(3, questionCount * 2);
  return Math.max(3, Math.round(info.durationMinutes * (questionCount / info.questions)));
}

export const CERT_EXAM_INFO: Record<string, ExamInfo> = {
  "Claude Certified Architect - Professional": {
    abbreviation: "CCAR-P",
    questions: 63,
    durationMinutes: 120,
    passingScore: "720 (scaled, 100-1,000)",
    cost: "$175 USD",
    domains: [
      { name: "Integration", weight: 19 },
      { name: "Solution Design & Architecture", weight: 17 },
      { name: "Evaluation, Testing & Optimisation", weight: 16 },
      { name: "Governance, Safety & Risk Management", weight: 14 },
      { name: "Stakeholder Communication & Lifecycle Management", weight: 14 },
      { name: "Claude Models, Prompting & Context Engineering", weight: 13 },
      { name: "Developer Productivity & Operational Enablement", weight: 7 },
    ],
  },
  "Claude Certified Architect - Foundations": {
    abbreviation: "CCAR-F",
    questions: 60,
    durationMinutes: 120,
    passingScore: "720 (scaled, 100-1,000)",
    cost: "$125 USD",
    domains: [
      { name: "Agentic Architecture & Orchestration", weight: 27 },
      { name: "Claude Code Configuration & Workflows", weight: 20 },
      { name: "Prompt Engineering & Structured Output", weight: 20 },
      { name: "Tool Design & MCP Integration", weight: 18 },
      { name: "Context Management & Reliability", weight: 15 },
    ],
  },
  "Claude Certified Developer - Foundations": {
    abbreviation: "CCDV-F",
    questions: 53,
    durationMinutes: 120,
    passingScore: "720 (scaled, 100-1,000)",
    cost: "$125 USD",
    domains: [
      { name: "Applications and Integration", weight: 33.1 },
      { name: "Model Selection and Optimisation", weight: 16.8 },
      { name: "Agents and Workflows", weight: 14.7 },
      { name: "Prompt and Context Engineering", weight: 11 },
      { name: "Tools and MCPs", weight: 10.6 },
      { name: "Security and Safety", weight: 8.1 },
      { name: "Claude Code", weight: 3.1 },
      { name: "Eval, Testing, and Debugging", weight: 2.6 },
    ],
  },
  "Claude Certified Associate - Foundations": {
    abbreviation: "CCAO-F",
    questions: 60,
    durationMinutes: 120,
    passingScore: "720 (scaled, 100-1,000)",
    cost: "$99 USD",
    domains: [
      { name: "Output Evaluation and Validation", weight: 21 },
      { name: "Workflow Integration and Solution Design", weight: 16 },
      { name: "Governance, Risk, and Responsible Use", weight: 15 },
      { name: "Prompting and Task Execution", weight: 14 },
      { name: "Product and Model Selection", weight: 12 },
      { name: "Configuration and Knowledge Management", weight: 12 },
      { name: "Troubleshooting and Optimisation", weight: 10 },
    ],
  },
};
