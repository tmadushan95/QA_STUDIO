using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace QaStudio.IntegrationTests;

[Collection(nameof(ApiTestGroup))]
public class SecurityAndGatewayTests(ApiFixture api)
{
    [Fact]
    public async Task Tests_never_touch_the_configured_database()
    {
        var scope = api.Services.CreateAsyncScope();
        await using (scope)
        {
            var name = scope.ServiceProvider.GetRequiredService<QaStudio.Infrastructure.Persistence.QaStudioDbContext>().Database.GetDbConnection().Database;
            Assert.StartsWith("QaStudio_Test_", name, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Every_response_carries_the_hardening_headers()
    {
        using var client = api.CreateClient();
        var response = await client.GetAsync("/api/health");
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
        Assert.Equal("no-referrer", response.Headers.GetValues("Referrer-Policy").Single());
    }

    [Fact]
    public async Task An_unexpected_host_name_is_refused()
    {
        using var client = api.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/projects");
        request.Headers.Host = "evil.example.com";
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.MisdirectedRequest, response.StatusCode);
        Assert.Equal("host-not-allowed", (await response.ReadErrorAsync()).Error.Code);
    }

    [Fact]
    public async Task Another_website_cannot_make_changes_through_the_browser()
    {
        using var client = api.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/projects") { Content = JsonContent.Create(new { code = "X", name = "X" }) };
        request.Headers.Add("Origin", "https://evil.example.com");
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("origin-not-allowed", (await response.ReadErrorAsync()).Error.Code);
    }

    [Fact]
    public async Task The_dev_server_proxy_can_make_changes_when_it_keeps_the_browsers_host()
    {
        // Vite forwards /api with the browser's Host (changeOrigin: false), so Origin and Host agree.
        using var client = api.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/projects") { Content = JsonContent.Create(new { code = "", name = "" }) };
        request.Headers.Host = "localhost:5173";
        request.Headers.Add("Origin", "http://localhost:5173");
        var response = await client.SendAsync(request);
        // Past the origin check: refused only for the empty fields, which proves the request reached the handler.
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_proxy_that_rewrites_the_host_is_refused_unless_its_origin_is_allowed()
    {
        // What Vite's shorthand proxy did: Host rewritten to the API, Origin still the dev server.
        using var client = api.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/projects") { Content = JsonContent.Create(new { code = "", name = "" }) };
        request.Headers.Add("Origin", "http://localhost:5173");
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("origin-not-allowed", (await response.ReadErrorAsync()).Error.Code);
    }

    [Fact]
    public async Task A_cross_site_fetch_is_refused_even_without_an_origin()
    {
        using var client = api.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/test-cases/delete") { Content = JsonContent.Create(new { ids = new[] { "X" } }) };
        request.Headers.Add("Sec-Fetch-Site", "cross-site");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task With_a_token_everything_needs_it_except_health_and_sign_in()
    {
        const string Token = "a-long-enough-admin-token";
        using var factory = api.WithSettings(("Security:AdminToken", Token));
        using var client = factory.CreateClient(new() { HandleCookies = true });

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/health")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/projects")).StatusCode);
        // The gateway is covered too: an unauthenticated call never reaches the worker.
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/runs")).StatusCode);

        var status = await (await client.GetAsync("/api/auth/status")).ReadAsync<AuthStatus>();
        Assert.True(status.Required);
        Assert.False(status.Authenticated);

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/login", new { token = "wrong" })).StatusCode);
        var login = await client.PostAsJsonAsync("/api/auth/login", new { token = Token });
        Assert.Equal(HttpStatusCode.NoContent, login.StatusCode);
        Assert.Contains(login.Headers.GetValues("Set-Cookie"), c => c.Contains("httponly", StringComparison.OrdinalIgnoreCase));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/projects")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/auth/logout", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/projects")).StatusCode);
    }

    [Fact]
    public async Task A_bearer_token_works_for_scripts()
    {
        const string Token = "a-long-enough-admin-token";
        using var factory = api.WithSettings(("Security:AdminToken", Token));
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/projects")).StatusCode);
    }

    [Fact]
    public async Task Sign_in_guesses_are_limited()
    {
        using var factory = api.WithSettings(("Security:AdminToken", "a-long-enough-admin-token"));
        using var client = factory.CreateClient();
        for (var i = 0; i < 5; i++)
        {
            await client.PostAsJsonAsync("/api/auth/login", new { token = "wrong" });
        }

        var response = await client.PostAsJsonAsync("/api/auth/login", new { token = "wrong" });
        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
    }

    [Fact]
    public async Task Worker_routes_report_a_stopped_worker_in_the_normal_error_shape()
    {
        using var client = api.CreateClient();
        var response = await client.GetAsync("/api/automation");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("worker-unavailable", (await response.ReadErrorAsync()).Error.Code);
    }

    private sealed record AuthStatus(bool Required, bool Authenticated);
}
