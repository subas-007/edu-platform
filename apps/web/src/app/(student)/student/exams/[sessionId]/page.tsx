import { ExamModeContainer } from '@/components/student/ExamModeContainer';

export default async function StudentExamPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return (
    <div className="mx-auto max-w-3xl">
      <ExamModeContainer sessionId={sessionId} />
    </div>
  );
}
