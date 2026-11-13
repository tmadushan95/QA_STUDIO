using FluentValidation;

namespace QaStudio.Application.Features.TestSuites.CreateTestSuite;

/// <summary>Checks the request's shape before a project is looked up. The suite's own rules are in the domain.</summary>
internal sealed class CreateTestSuiteValidator : AbstractValidator<CreateTestSuiteCommand>
{
    public CreateTestSuiteValidator() =>
        RuleFor(c => c.ProjectId).GreaterThan(0).WithMessage("Choose a project.");
}
