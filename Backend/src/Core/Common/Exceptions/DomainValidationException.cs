namespace QaStudio.Core.Common;

/// <summary>An entity refused values that would break its rules. It can therefore never exist in an invalid state.</summary>
/// <param name="fields">What is wrong with each field.</param>
public sealed class DomainValidationException(IReadOnlyDictionary<string, string> fields)
    : QaStudioException(ErrorCodes.InvalidRequest, FieldsNeedAttention, fields);
