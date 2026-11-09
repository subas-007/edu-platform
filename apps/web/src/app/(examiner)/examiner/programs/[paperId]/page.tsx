import { PaperDetailView } from '@/components/examiner/PaperDetailView';

export default async function ProgramDetailPage({ params }: { params: Promise<{ paperId: string }> }) {
  const { paperId } = await params;
  return <PaperDetailView paperId={paperId} basePath="/examiner" />;
}
