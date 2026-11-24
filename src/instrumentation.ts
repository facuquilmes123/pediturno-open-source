import type { Instrumentation } from 'next';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'production') {
    const { loadHostingerEnvironment } = await import('@/lib/hostinger-runtime');
    loadHostingerEnvironment();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { reportNextRequestFailure } = await import('@/lib/request-failure-journal');
    await reportNextRequestFailure(error, request, context);
  }
};
