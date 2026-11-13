using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.TestCases.GetNextCaseId;

/// <summary>Gets the ID a new test case would be given now.</summary>
public sealed record GetNextCaseIdQuery : IQuery<GetNextCaseIdResponse>;
