export default async function responseTypeMiddleware ( ctx: MiddlewareContext, next: Next ) {
    await next();

    const { request: { dataType }, response } = ctx;

    return await (response as any)[ dataType ]();
}