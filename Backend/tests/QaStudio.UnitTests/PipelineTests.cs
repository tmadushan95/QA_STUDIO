using FluentValidation;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using QaStudio.Application;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;
using QaStudio.Application.Features.TestCases.Common;
using QaStudio.Application.Features.TestCases.CreateTestCase;
using QaStudio.Application.Features.WorkerState.ApplyWorkerOperations;
using QaStudio.Application.Features.WorkerState.ApplyWorkerOperations.Strategies;
using QaStudio.Core.Common;

namespace QaStudio.UnitTests;

public class PipelineTests
{
    private sealed class Ping : IQuery<string>;

    private sealed class PingHandler(List<string> log) : IRequestHandler<Ping, string>
    {
        public Task<string> HandleAsync(Ping request, CancellationToken cancellationToken)
        {
            log.Add("handler");
            return Task.FromResult("pong");
        }
    }

    private sealed class Tracing(List<string> log) : IPipelineBehavior<Ping, string>
    {
        public async Task<string> HandleAsync(Ping request, Func<Task<string>> continuation, CancellationToken cancellationToken)
        {
            log.Add("before");
            var result = await continuation();
            log.Add("after");
            return result;
        }
    }

    private static void WorkerStrategyDependencies(ServiceCollection services) =>
        services
            .AddSingleton<IWorkerStateStore>(_ => null!)
            .AddSingleton<ITestCaseRepository>(_ => null!)
            .AddSingleton<ITestSuiteRepository>(_ => null!)
            .AddSingleton<IProjectVersionRepository>(_ => null!)
            .AddSingleton<IProjectRepository>(_ => null!)
            .AddSingleton<IUnitOfWork>(_ => null!)
            .AddSingleton<IClock>(_ => null!);

    private static ServiceProvider Services(Action<ServiceCollection>? extra = null)
    {
        var services = new ServiceCollection();
        services.AddSingleton(typeof(Microsoft.Extensions.Logging.ILogger<>), typeof(NullLogger<>));
        services.AddApplication();
        extra?.Invoke(services);
        return services.BuildServiceProvider();
    }

    [Fact]
    public async Task The_dispatcher_runs_behaviors_around_the_handler()
    {
        var log = new List<string>();
        using var provider = Services(s =>
        {
            s.AddSingleton(log);
            s.AddScoped<IRequestHandler<Ping, string>, PingHandler>();
            s.AddScoped<IPipelineBehavior<Ping, string>, Tracing>();
        });
        using var scope = provider.CreateScope();
        var result = await scope.ServiceProvider.GetRequiredService<IDispatcher>().SendAsync(new Ping(), CancellationToken.None);
        Assert.Equal("pong", result);
        Assert.Equal(["before", "handler", "after"], log);
    }

    [Fact]
    public async Task A_case_needs_a_suite_and_at_most_the_configured_steps()
    {
        using var provider = Services(s => s.Configure<LimitsOptions>(o => o.MaxStepsPerCase = 1));
        using var scope = provider.CreateScope();
        var validator = scope.ServiceProvider.GetRequiredService<IValidator<CreateTestCaseCommand>>();
        var input = new TestCaseInput { Steps = ["one", "two"] };
        var result = await validator.ValidateAsync(new CreateTestCaseCommand(null, 0, input));
        Assert.Contains(result.Errors, e => e.PropertyName == nameof(CreateTestCaseCommand.TestSuiteId));
        Assert.Contains(result.Errors, e => e.PropertyName.EndsWith(nameof(TestCaseInput.Steps), StringComparison.Ordinal));
    }

    [Fact]
    public void Every_operation_kind_has_exactly_one_strategy()
    {
        using var provider = Services(s => WorkerStrategyDependencies(s));
        using var scope = provider.CreateScope();
        var kinds = scope.ServiceProvider.GetServices<IWorkerOperationHandler>().SelectMany(h => h.Kinds).ToList();
        var declared = typeof(WorkerOperationKinds).GetFields().Select(f => (string)f.GetValue(null)!).ToList();
        Assert.Equal(declared.Order(StringComparer.Ordinal), kinds.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void A_malformed_operation_is_refused_rather_than_stored()
    {
        var operation = new WorkerOperation("scenario.delete");
        var error = Assert.Throws<RequestValidationException>(() => WorkerPayload.Key(operation));
        Assert.Equal("invalid-operation", error.Code);
    }
}

