import { Suspense } from 'react';
import { TutorChatPanel } from '@/components/student/TutorChatPanel';

export default function StudentTutorPage() {
  return (
    <Suspense>
      <TutorChatPanel />
    </Suspense>
  );
}
