import { Suspense } from 'react';
import { QuestionBankCurationView } from '@/components/examiner/QuestionBankCurationView';

export default function ExaminerQuestionBankPage() {
  return (
    <Suspense>
      <QuestionBankCurationView basePath="/examiner" />
    </Suspense>
  );
}
