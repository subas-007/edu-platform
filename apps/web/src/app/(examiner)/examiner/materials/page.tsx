import { MaterialLibraryView } from '@/components/MaterialLibraryView';
import { UploadMaterialForm } from '@/components/UploadMaterialForm';

export default function ExaminerMaterialsPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Content repository</h1>
      <UploadMaterialForm />
      <MaterialLibraryView canPublish />
    </>
  );
}
