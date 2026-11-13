using System.Text.Json;
using Microsoft.AspNetCore.Diagnostics;
using QaStudio.Core.Common;

namespace QaStudio.Api.Common;

/// <summary>Turns every failure into the error shape the frontend already reads: <c>{ error: { code, message, fields } }</c>.</summary>
/// <param name="logger">The logger.</param>
public sealed partial class ApiExceptionHandler(ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    /// <inheritdoc />
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(httpContext);
        var (status, body) = exception switch
        {
            NotFoundException e => (StatusCodes.Status404NotFound, ToBody(e)),
            ConflictException e => (StatusCodes.Status409Conflict, ToBody(e)),
            QaStudioException e => (StatusCodes.Status400BadRequest, ToBody(e)),
            BadHttpRequestException or JsonException => (StatusCodes.Status400BadRequest, new ErrorBody(ErrorCodes.BadRequest, "The request could not be read. Check it is valid JSON of the expected shape.")),
            // Internals stay in the log; the caller only learns that it was not their fault.
            _ => (StatusCodes.Status500InternalServerError, new ErrorBody(ErrorCodes.Internal, "Unexpected server error.")),
        };
        if (status == StatusCodes.Status500InternalServerError)
        {
            LogUnexpected(logger, exception, httpContext.Request.Path);
        }

        httpContext.Response.StatusCode = status;
        await httpContext.Response.WriteAsJsonAsync(new ErrorResponse(body), cancellationToken).ConfigureAwait(false);
        return true;
    }

    private static ErrorBody ToBody(QaStudioException e) => new(e.Code, e.Message, e.Fields);

    [LoggerMessage(Level = LogLevel.Error, Message = "Unexpected failure on {Path}")]
    private static partial void LogUnexpected(ILogger logger, Exception exception, PathString path);
}
