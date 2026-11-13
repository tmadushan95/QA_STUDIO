namespace QaStudio.Application.Features.TestCases.Common;

/// <summary>One written step as the API shows it.</summary>
/// <param name="Order">One-based position.</param>
/// <param name="Action">What the tester does.</param>
/// <param name="Expected">What should happen, when known.</param>
public sealed record TestStepResponse(int Order, string Action, string? Expected);
