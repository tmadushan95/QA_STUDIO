using FluentValidation;

namespace QaStudio.Application.Features.ProjectVersions.CreateProjectVersion;

/// <summary>Checks the request's shape before a project is looked up. The version's own rules are in the domain.</summary>
internal sealed class CreateProjectVersionValidator : AbstractValidator<CreateProjectVersionCommand>
{
    public CreateProjectVersionValidator() =>
        RuleFor(c => c.ProjectId).GreaterThan(0).WithMessage("Choose a project.");
}
