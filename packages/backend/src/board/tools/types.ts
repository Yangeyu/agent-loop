import { z } from "zod"

export const BoardAnalysisBundleTypeSchema = z.enum([
  "section_bundle",
  "text_bundle",
  "report_bundle",
  "web_bundle",
  "chart_bundle",
])

export const BoardAnalysisAssetWriteParameters = z.object({
  analysisId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  content: z.string().trim().min(1),
  focus: z.string().trim().min(1).optional(),
  sourceBundleTypes: z.array(BoardAnalysisBundleTypeSchema).min(1),
})

export const BoardAnalysisAssetReadParameters = z.object({
  analysisId: z.string().trim().min(1),
  names: z.array(z.string().trim().min(1)).min(1).optional(),
})

export const BoardReportWriteParameters = z.object({
  analysisId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  content: z.string().trim().min(1),
})
