/**
 * run이 send로 보낸 이벤트를 한 줄씩 JSON으로 흘려보내는 NDJSON 응답.
 * 오류 처리는 run이 맡고, 스트림은 run이 끝나면(throw 해도) 닫힌다.
 */
export function ndjsonResponse<E>(
    run: (send: (event: E) => void) => Promise<void>
): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
        async start(controller) {
            // 클라이언트가 연결을 끊은 뒤에는 enqueue/close가 throw 하므로 무시한다
            const send = (event: E) => {
                try {
                    controller.enqueue(
                        encoder.encode(JSON.stringify(event) + '\n')
                    );
                } catch {
                    /* 연결 종료됨 */
                }
            };
            try {
                await run(send);
            } finally {
                try {
                    controller.close();
                } catch {
                    /* 연결 종료됨 */
                }
            }
        },
    });
    return new Response(body, {
        headers: {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        },
    });
}
