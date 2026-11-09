import { MaterialStudyView } from '@/components/student/MaterialStudyView';

export default async function StudentMaterialPage({ params }: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await params;
  return <MaterialStudyView materialId={materialId} />;
}
