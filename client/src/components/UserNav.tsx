import CreatorNavBar from './CreatorNavBar';
import { useMyAssignments } from '@/hooks/useMyAssignments';

export default function UserNav() {
  const { assignments } = useMyAssignments();
  const pendingCount = assignments.filter(
    (assignment) =>
      assignment.participantStatus === 'not_started' ||
      assignment.participantStatus === 'in_progress',
  ).length;
  return (
    <CreatorNavBar
      basePath="/u"
      loginPath="/login"
      playLabel="Tham gia Live Game ↗"
      userNavigation
      assignmentCount={pendingCount}
    />
  );
}
