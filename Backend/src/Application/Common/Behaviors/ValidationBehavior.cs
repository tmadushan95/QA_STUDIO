using FluentValidation;
using QaStudio.Application.Abstractions;
using QaStudio.Core.Common;

namespace QaStudio.Application.Common;

/// <summary>Runs a request's validators before its handler, so handlers only ever see well-formed input.</summary>
/// <typeparam name="TRequest">The request.</typeparam>
/// <typeparam name="TResult">The result.</typeparam>
/// <param name="validators">Validators for this request.</param>
internal sealed class ValidationBehavior<TRequest, TResult>(IEnumerable<IValidator<TRequest>> validators)
    : IPipelineBehavior<TRequest, TResult>
    where TRequest : IRequest<TResult>
{
    public async Task<TResult> HandleAsync(TRequest request, Func<Task<TResult>> continuation, CancellationToken cancellationToken)
    {
        var fields = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var validator in validators)
        {
            var result = await validator.ValidateAsync(request, cancellationToken).ConfigureAwait(false);
            foreach (var failure in result.Errors)
            {
                // Forms bind to camelCase names. The first failure per field is the one worth showing.
                var name = JsonNames.ToCamelCase(failure.PropertyName);
                fields.TryAdd(name, failure.ErrorMessage);
            }
        }

        if (fields.Count > 0)
        {
            throw new RequestValidationException(ErrorCodes.InvalidRequest, QaStudioException.FieldsNeedAttention, fields);
        }

        return await continuation().ConfigureAwait(false);
    }
}
