import { QuestionBankCurationView } from '@/components/examiner/QuestionBankCurationView';

export default function ExaminerQuestionBankPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Question bank curation</h1>
      <p className="text-sm text-slate-500">
        AI-generated questions for staff-uploaded material stay out of exams until approved here.
      </p>
      <QuestionBankCurationView />
    </>
  );
}
