export default async function fetchMiddleware ( ctx: MiddlewareContext, next: Next ) {
    const { request } = ctx;
    const response: FetcherResponse = await fetch( request );

    ctx.response = response;

    return await next();
}