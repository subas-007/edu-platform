import { MaterialLibraryView } from '@/components/MaterialLibraryView';
import { UploadMaterialForm } from '@/components/UploadMaterialForm';

export function StudentDashboardView() {
  return (
    <>
      <h1 className="text-2xl font-semibold">My study materials</h1>
      <p className="text-sm text-slate-500">
        Course materials published by your examiners appear here alongside your own private uploads.
        Open a ready material for flashcards, a study roadmap and practice exams.
      </p>
      <UploadMaterialForm />
      <MaterialLibraryView studyLinkBase="/student/materials" />
    </>
  );
}
