import { MaterialLibraryView } from '@/components/MaterialLibraryView';
import { PageHeader } from '@/components/ui';
import { UploadMaterialForm } from '@/components/UploadMaterialForm';

export default function ExaminerMaterialsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Content"
        title="Content repository"
        subtitle="Upload course resources. Their AI-generated questions enter the question bank for review; publish a resource to make it visible to students."
      />
      <UploadMaterialForm />
      <MaterialLibraryView canPublish canDelete="own" bankLinkBase="/examiner/question-bank" />
    </>
  );
}
