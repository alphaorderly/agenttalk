// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { canModelSearch } from '../shared/providers';
import { errorMessage, isSearchToolRejection, reasoningNotice } from './llm';

describe('reasoningNotice', () => {
    it('ignores warnings unrelated to reasoning', () => {
        expect(reasoningNotice(undefined)).toBeNull();
        expect(
            reasoningNotice([{ type: 'unsupported', feature: 'temperature' }])
        ).toBeNull();
    });

    it('reports unsupported effort', () => {
        expect(
            reasoningNotice([
                {
                    type: 'unsupported',
                    feature: 'reasoning',
                    details: 'reasoning "high" is not supported by this model.',
                },
            ])
        ).toBe('effort 미지원 (무시됨)');
    });

    it('reports the effort a level was mapped to', () => {
        expect(
            reasoningNotice([
                {
                    type: 'compatibility',
                    feature: 'reasoning',
                    details:
                        'reasoning "xhigh" is not directly supported by this model. mapped to effort "high".',
                },
            ])
        ).toBe('effort → high');
    });
});

describe('errorMessage', () => {
    it('unwraps retry errors and prefers the provider message', () => {
        const apiError = {
            statusCode: 500,
            message: 'Internal Server Error',
            responseBody: '{"error":{"message":"model exploded"}}',
        };
        expect(
            errorMessage({
                message: 'Failed after 2 attempts',
                lastError: apiError,
            })
        ).toBe('500 model exploded');
    });
});

describe('isSearchToolRejection', () => {
    it('recognizes a model refusing the search tool', () => {
        expect(
            isSearchToolRejection(
                new Error(
                    "Tool 'web_search_preview' is not supported with gpt-4.1-nano."
                )
            )
        ).toBe(true);
        expect(
            isSearchToolRejection({
                statusCode: 400,
                message: 'Bad Request',
                responseBody: JSON.stringify({
                    error: {
                        message:
                            'Search Grounding is not supported. google_search tool is unsupported for this model',
                    },
                }),
            })
        ).toBe(true);
    });

    it('leaves other failures alone', () => {
        expect(isSearchToolRejection(new Error('Rate limit exceeded'))).toBe(
            false
        );
        expect(
            isSearchToolRejection(new Error('The model `x` does not exist'))
        ).toBe(false);
    });
});

describe('canModelSearch', () => {
    it('never asks a model that already rejected the search tool again', () => {
        const profile = {
            provider: 'openai' as const,
            noSearchModels: ['gpt-4.1-nano'],
        };
        expect(canModelSearch(profile, 'gpt-4.1-nano')).toBe(false);
        expect(canModelSearch(profile, 'gpt-5-mini')).toBe(true);
        expect(canModelSearch({ provider: 'ollama' }, 'x')).toBe(false);
    });
});
