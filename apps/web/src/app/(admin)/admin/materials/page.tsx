import { MaterialLibraryView } from '@/components/MaterialLibraryView';
import { PageHeader } from '@/components/ui';

export default function AdminMaterialsPage() {
  return (
    <>
      <PageHeader eyebrow="Content" title="Asset moderation" subtitle="Every uploaded material across the platform. Publish, unpublish or remove content." />
      <MaterialLibraryView canPublish canDelete="any" bankLinkBase="/admin/question-bank" />
    </>
  );
}
