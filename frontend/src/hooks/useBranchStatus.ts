import { useQuery } from '@tanstack/react-query';
import { attemptsApi } from '@/lib/api';

export function useBranchStatus(attemptId?: string) {
  return useQuery({
    queryKey: ['branchStatus', attemptId],
    queryFn: ({ signal }) => attemptsApi.getBranchStatus(attemptId!, signal),
    enabled: !!attemptId,
    refetchInterval: 5000,
  });
}
