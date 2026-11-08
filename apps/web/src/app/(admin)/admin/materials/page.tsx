import { MaterialLibraryView } from '@/components/MaterialLibraryView';

export default function AdminMaterialsPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Global asset moderation</h1>
      <MaterialLibraryView canPublish />
    </>
  );
}
