class IntegrationError(Exception):
    pass


class IntegrationNetworkError(IntegrationError):
    pass


class AppNotFoundError(IntegrationError):
    pass


class AppInactiveError(IntegrationError):
    pass
