export type GenerateQuestionsParams = {
  fileBase64: string;
  mimeType: string;
  subjectName: string;
  count?: number;
};

export type AiProvider = "claude" | "gemini";
