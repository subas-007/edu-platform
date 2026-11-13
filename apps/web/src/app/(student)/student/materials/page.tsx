import { MaterialLibraryView } from '@/components/MaterialLibraryView';
import { PageHeader } from '@/components/ui';
import { UploadMaterialForm } from '@/components/UploadMaterialForm';

export default function StudentMaterialsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Learn"
        title="My materials"
        subtitle="Course materials published by your examiners appear alongside your own private uploads. Open a ready material for flashcards, a study roadmap and practice."
      />
      <UploadMaterialForm onDemand />
      <MaterialLibraryView studyLinkBase="/student/materials" canDelete="own" />
    </>
  );
}
