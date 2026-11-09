import { Suspense } from 'react';
import { PaperBuilderView } from '@/components/examiner/PaperBuilderView';

export default function NewProgramPage() {
  return (
    <Suspense>
      <PaperBuilderView basePath="/admin" />
    </Suspense>
  );
}
