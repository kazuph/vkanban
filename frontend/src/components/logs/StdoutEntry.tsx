import RawLogText from '@/components/common/RawLogText';

interface StdoutEntryProps {
  content: string;
  repoUrlBase?: string;
}

function StdoutEntry({ content, repoUrlBase }: StdoutEntryProps) {
  return (
    <RawLogText
      content={content}
      channel="stdout"
      as="span"
      repoUrlBase={repoUrlBase}
    />
  );
}

export default StdoutEntry;
