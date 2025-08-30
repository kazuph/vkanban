import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '@/lib/api';

export function useProjectBranches(projectId?: string) {
  return useQuery({
    queryKey: ['projectBranches', projectId],
    queryFn: ({ signal }) => projectsApi.getBranches(projectId!, signal),
    enabled: !!projectId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
