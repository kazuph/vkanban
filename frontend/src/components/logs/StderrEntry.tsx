import RawLogText from '@/components/common/RawLogText';

interface StderrEntryProps {
  content: string;
  repoUrlBase?: string;
}

function StderrEntry({ content, repoUrlBase }: StderrEntryProps) {
  return (
    <RawLogText
      content={content}
      channel="stderr"
      as="span"
      repoUrlBase={repoUrlBase}
    />
  );
}

export default StderrEntry;
