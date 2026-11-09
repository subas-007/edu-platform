import { Suspense } from 'react';
import { FlashcardStudio } from '@/components/student/FlashcardStudio';

export default function StudentFlashcardsPage() {
  return (
    <Suspense>
      <FlashcardStudio />
    </Suspense>
  );
}
