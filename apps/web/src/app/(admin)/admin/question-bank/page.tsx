import { Suspense } from 'react';
import { QuestionBankCurationView } from '@/components/examiner/QuestionBankCurationView';

export default function AdminQuestionBankPage() {
  return (
    <Suspense>
      <QuestionBankCurationView basePath="/admin" />
    </Suspense>
  );
}
