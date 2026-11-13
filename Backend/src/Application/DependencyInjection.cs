using FluentValidation;
using Microsoft.Extensions.DependencyInjection;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;
using QaStudio.Application.Features.Parameters.Common;
using QaStudio.Application.Features.Projects.Common;
using QaStudio.Application.Features.ProjectVersions.Common;
using QaStudio.Application.Features.TestCases.Common;
using QaStudio.Application.Features.TestSuites.Common;
using QaStudio.Application.Features.WorkerState.ApplyWorkerOperations;

namespace QaStudio.Application;

/// <summary>Registers the application layer.</summary>
public static class DependencyInjection
{
    /// <summary>Adds the dispatcher, behaviors, shared services, and every handler, validator and strategy it finds.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection.</returns>
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        var assembly = typeof(DependencyInjection).Assembly;
        services.AddOptions<LimitsOptions>().ValidateDataAnnotations().ValidateOnStart();
        services.AddScoped<IDispatcher, Dispatcher>();
        // Order matters: logging wraps validation, so a refused request is timed too.
        services.AddScoped(typeof(IPipelineBehavior<,>), typeof(LoggingBehavior<,>));
        services.AddScoped(typeof(IPipelineBehavior<,>), typeof(ValidationBehavior<,>));
        services.AddValidatorsFromAssembly(assembly, includeInternalTypes: true);
        services.AddScoped<MasterDataCommit>();
        services.AddScoped<TestCaseCommit>();
        services.AddScoped<ProjectResponseBuilder>();
        services.AddScoped<TestSuiteResponseBuilder>();
        services.AddScoped<ProjectVersionResponseBuilder>();
        services.AddScoped<DefaultSuiteResolver>();
        services.AddScoped<ParameterReads>();
        services.AddScoped<ParameterSuggester>();

        var concreteTypes = assembly.GetTypes().Where(type => type is { IsClass: true, IsAbstract: false, IsGenericType: false }).ToList();
        // A new strategy or handler only has to exist: nothing else changes to add one.
        foreach (var strategy in concreteTypes.Where(type => type.IsAssignableTo(typeof(IWorkerOperationHandler))))
        {
            services.AddScoped(typeof(IWorkerOperationHandler), strategy);
        }

        var handlers = concreteTypes.SelectMany(type => type.GetInterfaces()
            .Where(contract => contract.IsGenericType && contract.GetGenericTypeDefinition() == typeof(IRequestHandler<,>))
            .Select(contract => (contract, type)));
        foreach (var (contract, type) in handlers)
        {
            services.AddScoped(contract, type);
        }

        return services;
    }
}
