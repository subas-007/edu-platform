import { AuditLogTableView } from '@/components/admin/AuditLogTableView';

export default function AdminAuditLogsPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Audit logs</h1>
      <AuditLogTableView />
    </>
  );
}
