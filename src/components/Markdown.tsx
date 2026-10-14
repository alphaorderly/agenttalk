import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@utils/cn/cn';

/** 좁은 패널에서 읽기 좋은 크기로 맞춘 마크다운 요소. 원본 HTML은 렌더링하지 않는다. */
const components: Components = {
    h1: ({ children }) => (
        <h3 className="mt-4 mb-1.5 text-[14px] font-bold first:mt-0">
            {children}
        </h3>
    ),
    h2: ({ children }) => (
        <h3 className="mt-4 mb-1.5 text-[13px] font-bold first:mt-0">
            {children}
        </h3>
    ),
    h3: ({ children }) => (
        <h4 className="mt-3 mb-1 text-[12.5px] font-semibold first:mt-0">
            {children}
        </h4>
    ),
    h4: ({ children }) => (
        <h5 className="mt-2 mb-1 text-[12px] font-semibold text-neutral-700 first:mt-0">
            {children}
        </h5>
    ),
    p: ({ children }) => <p className="my-1.5 first:mt-0">{children}</p>,
    ul: ({ children }) => (
        <ul className="my-1.5 list-disc space-y-0.5 pl-4">{children}</ul>
    ),
    ol: ({ children }) => (
        <ol className="my-1.5 list-decimal space-y-0.5 pl-4">{children}</ol>
    ),
    li: ({ children }) => <li className="pl-0.5">{children}</li>,
    strong: ({ children }) => (
        <strong className="font-semibold text-neutral-900">{children}</strong>
    ),
    a: ({ children, href }) => (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-700 underline"
        >
            {children}
        </a>
    ),
    blockquote: ({ children }) => (
        <blockquote className="my-2 border-l-2 border-neutral-300 pl-2.5 text-neutral-600">
            {children}
        </blockquote>
    ),
    code: ({ children }) => (
        <code className="rounded bg-neutral-100 px-1 py-0.5 text-[11px]">
            {children}
        </code>
    ),
    hr: () => <hr className="my-3 border-neutral-200" />,
    table: ({ children }) => (
        <div className="my-2 overflow-x-auto">
            <table className="w-full border-collapse text-[11.5px]">
                {children}
            </table>
        </div>
    ),
    th: ({ children }) => (
        <th className="border-b border-neutral-200 px-1.5 py-1 text-left font-semibold">
            {children}
        </th>
    ),
    td: ({ children }) => (
        <td className="border-b border-neutral-100 px-1.5 py-1 align-top">
            {children}
        </td>
    ),
};

const Markdown = ({
    children,
    className,
}: {
    children: string;
    className?: string;
}) => (
    <div
        className={cn(
            'text-[12.5px] leading-relaxed break-words text-neutral-800',
            className
        )}
    >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {children}
        </ReactMarkdown>
    </div>
);

export default Markdown;
