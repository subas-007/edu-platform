import { Suspense } from 'react';
import { PracticeCenter } from '@/components/student/PracticeCenter';

export default function StudentPracticePage() {
  return (
    <Suspense>
      <PracticeCenter />
    </Suspense>
  );
}
